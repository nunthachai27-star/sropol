unit HOSxPPCUAccount2ANCServiceListFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, JvExControls, JvNavigationPane, ExtCtrls, cxGraphics, cxLookAndFeels,
  cxLookAndFeelPainters, Menus, dxSkinsCore, dxSkinsDefaultPainters, StdCtrls,
  cxButtons, cxControls, cxStyles, dxSkinscxPCPainter, cxCustomData, cxFilter,
  cxData, cxDataStorage, cxEdit, cxNavigator, DB, cxDBData, cxTextEdit,
  cxGridLevel, cxGridCustomTableView, cxGridTableView, cxGridDBTableView,
  cxClasses, cxGridCustomView, cxGrid, DBClient, cxImageComboBox, cxCheckBox,
  cxSpinEdit, ImgList, cxImageList, dxDateRanges, dxScrollbarAnnotations;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}
type
  THOSxPPCUAccount2ANCServiceListFrame = class(TFrame)
   JvNavPanelHeader1: TJvNavPanelHeader;
    Panel1: TPanel;
    PersonANCServiceListCDS: TClientDataSet;
    PersonANCServiceListDS: TDataSource;
   
    AddButton: TcxButton;
    EditButton: TcxButton;
    LogViewButton: TcxButton;
    cxGrid1: TcxGrid;
    cxGrid1DBTableView1: TcxGridDBTableView;
    cxGrid1DBTableView1Column3: TcxGridDBColumn;
    cxGrid1DBTableView1anc_service_date: TcxGridDBColumn;
    cxGrid1DBTableView1Column1: TcxGridDBColumn;
    cxGrid1DBTableView1Column7: TcxGridDBColumn;
    cxGrid1DBTableView1Column11: TcxGridDBColumn;
    cxGrid1DBTableView1Column6: TcxGridDBColumn;
    cxGrid1DBTableView1Column2: TcxGridDBColumn;
    cxGrid1DBTableView1Column8: TcxGridDBColumn;
    cxGrid1DBTableView1Column9: TcxGridDBColumn;
    cxGrid1DBTableView1Column10: TcxGridDBColumn;
    cxGrid1DBTableView1anc_service_note: TcxGridDBColumn;
    cxGrid1DBTableView1Column5: TcxGridDBColumn;
    cxGrid1Level1: TcxGridLevel;
    cxImageList1: TcxImageList;
    
    procedure cxGrid1DBTableView1DBColumn1GetDisplayText(
      Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);

    procedure AddButtonClick(Sender: TObject);
    procedure EditButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
    procedure cxGrid1DBTableView1Column3GetDisplayText(
      Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);
  private
    FPersonANCID: integer;
    FPersonID : Integer;
    { Private declarations }
    
    procedure RefreshData;
    procedure SetPersonANCID(const Value: integer);
  public
    { Public declarations }


    property PersonANCID : integer read FPersonANCID write SetPersonANCID;
    procedure HideTaskBar;
  end;



implementation
uses HOSxPDMU,BMSApplicationUtil,Account1PersonDMUnit;


{$R *.dfm}

procedure THOSxPPCUAccount2ANCServiceListFrame.AddButtonClick(Sender: TObject);
begin



   ExecuteRTTIFunction('HOSxPPCUAccount2ANCServiceEntryFormUnit.THOSxPPCUAccount2ANCServiceEntryForm','DoShowForm',[FPersonANCID,  0]);
   RefreshData;
end;

procedure THOSxPPCUAccount2ANCServiceListFrame.EditButtonClick(Sender: TObject);
begin
    if PersonANCServiceListCDS.RecordCount=0 then
   exit;
   ExecuteRTTIFunction('HOSxPPCUAccount2ANCServiceEntryFormUnit.THOSxPPCUAccount2ANCServiceEntryForm','DoShowForm',[ FPersonANCID,
   PersonANCServiceListCDS.FieldByName('person_anc_service_id').AsInteger
   ]);
   RefreshData;
end;

procedure THOSxPPCUAccount2ANCServiceListFrame.HideTaskBar;
begin
  panel1.Visible:=false;
end;

procedure THOSxPPCUAccount2ANCServiceListFrame.LogViewButtonClick(Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_service"',
    '']);
end;



procedure THOSxPPCUAccount2ANCServiceListFrame.cxGrid1DBTableView1Column3GetDisplayText(
  Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  atext:=inttostr(arecord.Index+1);
end;

procedure THOSxPPCUAccount2ANCServiceListFrame.cxGrid1DBTableView1DBColumn1GetDisplayText(
  Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  atext:=inttostr(arecord.Index+1);
end;


procedure THOSxPPCUAccount2ANCServiceListFrame.RefreshData;
var V:Variant;
begin
   try
   FPersonID := getsqldata('select person_id from person_anc where person_anc_id = '+
    inttostr(FPersonANCID));
   except
      FPersonID := 0;
   end;
   v := 0;

   if PersonANCServiceListCDS.active then
   if PersonANCServiceListCDS.recordcount>0 then
   V:=PersonANCServiceListCDS.fieldbyname('person_anc_service_id').asVariant;

  PersonANCServiceListCDS.data :=
    hosxp_getdataset('select p1.*,p2.* from person_anc_service p1 ' +
    ' left outer join person_anc_screen p2 on p2.person_anc_service_id = p1.person_anc_service_id ' +
    ' where ' +
    ' p1.person_anc_id = ' + inttostr(fpersonancid) +
    ' order by p1.anc_service_date');

  if v >0 then
  PersonANCServiceListCDS.locate('person_anc_service_id',vararrayof([v]),[]);

end;

procedure THOSxPPCUAccount2ANCServiceListFrame.SetPersonANCID(
  const Value: integer);
begin
  FPersonANCID := Value;
  RefreshDAta;
end;

end.
