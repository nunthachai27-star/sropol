unit HOSxPPCUAccount2PersonANCLabListFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, JvExControls, JvNavigationPane, ExtCtrls, cxGraphics, cxLookAndFeels,
  cxLookAndFeelPainters, Menus, dxSkinsCore, dxSkinsDefaultPainters, StdCtrls,
  cxButtons, cxControls, cxStyles, dxSkinscxPCPainter, cxCustomData, cxFilter,
  cxData, cxDataStorage, cxEdit, cxNavigator, DB, cxDBData, cxTextEdit,
  cxGridLevel, cxGridCustomTableView, cxGridTableView, cxGridDBTableView,
  cxClasses, cxGridCustomView, cxGrid, DBClient, cxImageComboBox, ImgList, dxDateRanges, dxScrollbarAnnotations, cxImageList;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}

type
  THOSxPPCUAccount2PersonANCLabListFrame = class(TFrame)
   JvNavPanelHeader1: TJvNavPanelHeader;
    Panel1: TPanel;
  
    cxGrid1: TcxGrid;
    cxGrid1DBTableView1: TcxGridDBTableView;
    cxGrid1DBTableView1DBColumn1: TcxGridDBColumn;
    cxGrid1Level1: TcxGridLevel;
    PersonANCLabListCDS: TClientDataSet;
    PersonANCLabListDS: TDataSource;
   
    AddButton: TcxButton;
    EditButton: TcxButton;
    LogViewButton: TcxButton;
    cxGrid1DBTableView1anc_lab_result: TcxGridDBColumn;
    cxGrid1DBTableView1lab_result_normal: TcxGridDBColumn;
    cxGrid1DBTableView1anc_lab_name: TcxGridDBColumn;
    cxImageList1: TcxImageList;
    cxButton1: TcxButton;
    PersonANCLabCDS: TClientDataSet;
    
    procedure cxGrid1DBTableView1DBColumn1GetDisplayText(
      Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);

    procedure AddButtonClick(Sender: TObject);
    procedure EditButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
    procedure cxButton1Click(Sender: TObject);
    procedure PersonANCLabCDSBeforePost(DataSet: TDataSet);
  private
    FPersonANCServiceID: integer;
    FVN: String;
    { Private declarations }
    
    procedure RefreshData;
    procedure SetPersonANCServiceID(const Value: integer);
    procedure SetVN(const Value: String);
  public
    { Public declarations }

    property PersonANCServiceID : integer read FPersonANCServiceID write SetPersonANCServiceID;
    property VN : String read FVN write SetVN;
  end;



implementation
uses HOSxPDMU,BMSApplicationUtil;


{$R *.dfm}

procedure THOSxPPCUAccount2PersonANCLabListFrame.AddButtonClick(Sender: TObject);
begin
   ExecuteRTTIFunction('HOSxPPCUAccount2PersonANCLabEntryFormUnit.THOSxPPCUAccount2PersonANCLabEntryForm','DoShowForm',[ FPersonANCServiceID, 0]);
   RefreshData;
end;

procedure THOSxPPCUAccount2PersonANCLabListFrame.EditButtonClick(Sender: TObject);
begin
    if PersonANCLabListCDS.RecordCount=0 then
   exit;
   ExecuteRTTIFunction('HOSxPPCUAccount2PersonANCLabEntryFormUnit.THOSxPPCUAccount2PersonANCLabEntryForm','DoShowForm',[FPersonANCServiceID,
   PersonANCLabListCDS.FieldByName('person_anc_lab_id').AsInteger
   ]);
   RefreshData;
end;

procedure THOSxPPCUAccount2PersonANCLabListFrame.LogViewButtonClick(Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_lab"',
    '']);
end;



procedure THOSxPPCUAccount2PersonANCLabListFrame.PersonANCLabCDSBeforePost(
  DataSet: TDataSet);
begin
  if (dataset.State in [dsinsert]) then
  begin
   repeat
    dataset.FieldByName('person_anc_lab_id').AsInteger:=
     getserialnumber('person_anc_lab_id');
   until getsqldata('select count(*) as cc from person_anc_lab where person_anc_lab_id = '+
    inttostr(dataset.FieldByName('person_anc_lab_id').AsInteger))=0;
  end;

  dataset.FieldByName('person_anc_service_id').AsInteger:=FPersonANCServiceID;

end;

procedure THOSxPPCUAccount2PersonANCLabListFrame.cxButton1Click(
  Sender: TObject);
var rc,lc:tclientdataset;
begin

 if not validvncode(fvn) then
 exit;

   PersonANCLabCDS.data := hosxp_getdataset
    ('select * from person_anc_lab where person_anc_service_id = ' +
    inttostr(FPersonANCServiceID));

  rc := TClientDataSet.Create(nil);
  lc := TClientDataSet.Create(nil);
  lc.data := hosxp_getdataset('select * from anc_lab ');
  while not lc.eof do
  begin
    if lc.FieldByName('lab_items_code').AsInteger > 0 then
    begin
      if not PersonANCLabCDS.locate('anc_lab_id',
        vararrayof([lc.FieldByName('anc_lab_id').AsInteger]), []) then
      begin
        if getsqldata
          ('select count(l1.lab_items_code) as cc from lab_order l1,lab_head l2 '
          + '  where l1.lab_order_number = l2.lab_order_number and l2.vn = "' +
          FVN + '" and ' + ' l1.lab_items_code=' +
          lc.FieldByName('lab_items_code').asstring) > 0 then
        begin
          rc.data := hosxp_getdataset
            ('select l1.* from lab_order l1,lab_head l2 ' +
            '  where l1.lab_order_number = l2.lab_order_number and l2.vn = "' +
            FVN + '" and ' + ' l1.lab_items_code=' +
            lc.FieldByName('lab_items_code').asstring + ' and l1.confirm="Y" ');
          if rc.recordcount > 0 then
            if rc.FieldByName('lab_order_result').asstring <> '' then
            begin
              PersonANCLabCDS.append;
              PersonANCLabCDS.FieldByName('anc_lab_id').AsInteger :=
                lc.FieldByName('anc_lab_id').AsInteger;
              PersonANCLabCDS.FieldByName('anc_lab_result').asstring :=
                rc.FieldByName('lab_order_result').asstring;
              PersonANCLabCDS.post;

            end;

        end;

      end
      else
      begin
        if getsqldata
          ('select count(l1.lab_items_code) as cc from lab_order l1,lab_head l2 '
          + '  where l1.lab_order_number = l2.lab_order_number and l2.vn = "' +
          FVN + '" and ' + ' l1.lab_items_code=' +
          lc.FieldByName('lab_items_code').asstring) > 0 then
        begin
          rc.data := hosxp_getdataset
            ('select l1.* from lab_order l1,lab_head l2 ' +
            '  where l1.lab_order_number = l2.lab_order_number and l2.vn = "' +
            FVN + '" and ' + ' l1.lab_items_code=' +
            lc.FieldByName('lab_items_code').asstring + ' and l1.confirm="Y" ');
          if rc.recordcount > 0 then
            if trim(PersonANCLabCDS.FieldByName('anc_lab_result').asstring)
              = '' then
              if rc.FieldByName('lab_order_result').asstring <> '' then
              begin
                PersonANCLabCDS.edit;
                PersonANCLabCDS.FieldByName('anc_lab_id').AsInteger :=
                  lc.FieldByName('anc_lab_id').AsInteger;
                PersonANCLabCDS.FieldByName('anc_lab_result').asstring :=
                  rc.FieldByName('lab_order_result').asstring;
                PersonANCLabCDS.post;

              end;

        end;

      end;
    end;

    lc.next;
  end;

  lc.Free;
  rc.Free;
  if PersonANCLabCDS.ChangeCount > 0 then
    hosxp_updatedelta(

      PersonANCLabCDS.delta,
      'select * from person_anc_lab where person_anc_service_id = ' +
      inttostr(FPersonANCServiceID));
    PersonANCLabCDS.close;

    refreshdata;
end;

procedure THOSxPPCUAccount2PersonANCLabListFrame.cxGrid1DBTableView1DBColumn1GetDisplayText(
  Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  atext:=inttostr(arecord.Index+1);
end;


procedure THOSxPPCUAccount2PersonANCLabListFrame.RefreshData;
var V:Variant;
begin




   v := 0;

   if PersonANCLabListCDS.active then
   if PersonANCLabListCDS.recordcount>0 then
   V:=PersonANCLabListCDS.fieldbyname('person_anc_lab_id').asVariant;

  PersonANCLabListCDS.Data:=HOSxP_GetDataSet(
  'select p1.* ,a1.anc_lab_name '+
  ' from person_anc_lab p1 '+
  ' left outer join anc_lab a1 on a1.anc_lab_id = p1.anc_lab_id '+
  ' where p1.person_anc_service_id = '+inttostr(FPersonANCServiceID)
  );

  if v >0 then
  PersonANCLabListCDS.locate('person_anc_lab_id',vararrayof([v]),[]);

end;

procedure THOSxPPCUAccount2PersonANCLabListFrame.SetPersonANCServiceID(
  const Value: integer);
begin
  FPersonANCServiceID := Value;
  RefreshData;
end;

procedure THOSxPPCUAccount2PersonANCLabListFrame.SetVN(const Value: String);
begin
  FVN := Value;
end;

end.
