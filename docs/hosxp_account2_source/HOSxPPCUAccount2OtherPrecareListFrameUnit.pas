unit HOSxPPCUAccount2OtherPrecareListFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, JvExControls, JvNavigationPane, ExtCtrls, cxGraphics, cxLookAndFeels,
  cxLookAndFeelPainters, Menus, dxSkinsCore, dxSkinsDefaultPainters, StdCtrls,
  cxButtons, cxControls, cxStyles, dxSkinscxPCPainter, cxCustomData, cxFilter,
  cxData, cxDataStorage, cxEdit, cxNavigator, DB, cxDBData, cxTextEdit,
  cxGridLevel, cxGridCustomTableView, cxGridTableView, cxGridDBTableView,
  cxClasses, cxGridCustomView, cxGrid, DBClient, cxCalendar, dxDateRanges, dxScrollbarAnnotations;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}

type
  THOSxPPCUAccount2OtherPrecareListFrame = class(TFrame)
   JvNavPanelHeader1: TJvNavPanelHeader;
    Panel1: TPanel;
  
    cxGrid1: TcxGrid;
    cxGrid1DBTableView1: TcxGridDBTableView;
    cxGrid1DBTableView1DBColumn1: TcxGridDBColumn;
    cxGrid1Level1: TcxGridLevel;
    PersonANCOtherPrecareListCDS: TClientDataSet;
    PersonANCOtherPrecareListDS: TDataSource;
   
    AddButton: TcxButton;
    EditButton: TcxButton;
    LogViewButton: TcxButton;
    cxGrid1DBTableView1precare_date: TcxGridDBColumn;
    cxGrid1DBTableView1precare_hospcode: TcxGridDBColumn;
    cxGrid1DBTableView1precare_no: TcxGridDBColumn;
    cxGrid1DBTableView1Column1: TcxGridDBColumn;
    cxGrid1DBTableView1Column2: TcxGridDBColumn;
    
    procedure cxGrid1DBTableView1DBColumn1GetDisplayText(
      Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);

    procedure AddButtonClick(Sender: TObject);
    procedure EditButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
  private
    FPersonANCID: integer;
    { Private declarations }
    
    procedure RefreshData;
    procedure SetPersonANCID(const Value: integer);
  public
    { Public declarations }
   
    property PersonANCID : integer read FPersonANCID write SetPersonANCID;
  end;



implementation
uses HOSxPDMU,BMSApplicationUtil;


{$R *.dfm}

procedure THOSxPPCUAccount2OtherPrecareListFrame.AddButtonClick(Sender: TObject);
begin
   ExecuteRTTIFunction('HOSxPPCUAccount2OtherPrecareEntryFormUnit.THOSxPPCUAccount2OtherPrecareEntryForm','DoShowForm',[ FPersonANCID, 0]);
   RefreshData;
end;

procedure THOSxPPCUAccount2OtherPrecareListFrame.EditButtonClick(Sender: TObject);
begin
    if PersonANCOtherPrecareListCDS.RecordCount=0 then
   exit;
   ExecuteRTTIFunction('HOSxPPCUAccount2OtherPrecareEntryFormUnit.THOSxPPCUAccount2OtherPrecareEntryForm','DoShowForm',[ FPersonANCID,
   PersonANCOtherPrecareListCDS.FieldByName('person_anc_other_precare_id').AsInteger
   ]);
   RefreshData;
end;

procedure THOSxPPCUAccount2OtherPrecareListFrame.LogViewButtonClick(Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_other_precare"',
    '']);
end;



procedure THOSxPPCUAccount2OtherPrecareListFrame.cxGrid1DBTableView1DBColumn1GetDisplayText(
  Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  atext:=inttostr(arecord.Index+1);
end;


procedure THOSxPPCUAccount2OtherPrecareListFrame.RefreshData;
var V:Variant;
begin

   v := 0;

   if PersonANCOtherPrecareListCDS.active then
   if PersonANCOtherPrecareListCDS.recordcount>0 then
   V:=PersonANCOtherPrecareListCDS.fieldbyname('person_anc_other_precare_id').asVariant;

  PersonANCOtherPrecareListCDS.Data:=HOSxP_GetDataSet(
  'select p1.*,concat(h1.hosptype," ",h1.name) as hospital_name,a1.anc_result_type_name '+
  ' from person_anc_other_precare p1 '+
  ' left outer join hospcode h1 on h1.hospcode = p1.precare_hospcode '+
  ' left outer join anc_result_type a1 on a1.anc_result_type_id = p1.anc_result '+
  ' where p1.person_anc_id = '+inttostr(FPersonANCID)+
  ' order by p1.precare_date '
  );

  if v >0 then
  PersonANCOtherPrecareListCDS.locate('person_anc_other_precare_id',vararrayof([v]),[]);

end;

procedure THOSxPPCUAccount2OtherPrecareListFrame.SetPersonANCID(
  const Value: integer);
begin
  FPersonANCID := Value;
  RefreshData;
end;

end.
