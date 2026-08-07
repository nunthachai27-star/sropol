unit HOSxPPCUAccount2ListFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, JvExControls, JvNavigationPane, ExtCtrls, cxGraphics, cxLookAndFeels,
  cxLookAndFeelPainters, Menus, dxSkinsCore, dxSkinsDefaultPainters, StdCtrls,
  cxButtons, cxControls, cxStyles, dxSkinscxPCPainter, cxCustomData, cxFilter,
  cxData, cxDataStorage, cxEdit, cxNavigator, DB, cxDBData, cxTextEdit,
  cxGridLevel, cxGridCustomTableView, cxGridTableView, cxGridDBTableView,
  cxClasses, cxGridCustomView, cxGrid, DBClient, cxImageComboBox, cxCalendar,
  cxCheckBox, dxDateRanges, dxScrollbarAnnotations;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}
type
  THOSxPPCUAccount2ListFrame = class(TFrame)
   JvNavPanelHeader1: TJvNavPanelHeader;
    Panel1: TPanel;
    PersonANCListCDS: TClientDataSet;
    PersonANCListDS: TDataSource;
   
    AddButton: TcxButton;
    EditButton: TcxButton;
    LogViewButton: TcxButton;
    cxGrid1: TcxGrid;
    cxGrid1DBTableView1: TcxGridDBTableView;
    cxGrid1DBTableView1Column1: TcxGridDBColumn;
    cxGrid1DBTableView1person_anc_no: TcxGridDBColumn;
    cxGrid1DBTableView1Column28: TcxGridDBColumn;
    cxGrid1DBTableView1preg_no: TcxGridDBColumn;
    cxGrid1DBTableView1Column29: TcxGridDBColumn;
    cxGrid1DBTableView1Column2: TcxGridDBColumn;
    cxGrid1DBTableView1Column3: TcxGridDBColumn;
    cxGrid1DBTableView1labor_date: TcxGridDBColumn;
    cxGrid1DBTableView1current_preg_age: TcxGridDBColumn;
    cxGrid1DBTableView1Column9: TcxGridDBColumn;
    cxGrid1DBTableView1Column7: TcxGridDBColumn;
    cxGrid1DBTableView1Column10: TcxGridDBColumn;
    cxGrid1DBTableView1anc_register_date: TcxGridDBColumn;
    cxGrid1DBTableView1anc_register_staff: TcxGridDBColumn;
    cxGrid1DBTableView1ptname: TcxGridDBColumn;
    cxGrid1DBTableView1Column4: TcxGridDBColumn;
    cxGrid1DBTableView1Column5: TcxGridDBColumn;
    cxGrid1DBTableView1current_age: TcxGridDBColumn;
    cxGrid1DBTableView1Column8: TcxGridDBColumn;
    cxGrid1DBTableView1address: TcxGridDBColumn;
    cxGrid1DBTableView1road: TcxGridDBColumn;
    cxGrid1DBTableView1village_moo: TcxGridDBColumn;
    cxGrid1DBTableView1village_name: TcxGridDBColumn;
    cxGrid1DBTableView1full_address_name: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt1_date: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt2_date: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt3_date: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt4_date: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt_complete: TcxGridDBColumn;
    cxGrid1DBTableView1Column16: TcxGridDBColumn;
    cxGrid1DBTableView1Column17: TcxGridDBColumn;
    cxGrid1DBTableView1Column18: TcxGridDBColumn;
    cxGrid1DBTableView1Column19: TcxGridDBColumn;
    cxGrid1DBTableView1Column20: TcxGridDBColumn;
    cxGrid1DBTableView1blood_check1_date: TcxGridDBColumn;
    cxGrid1DBTableView1blood_check2_date: TcxGridDBColumn;
    cxGrid1DBTableView1blood_vdrl1_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_vdrl2_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_hiv1_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_hiv2_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_of_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_hct_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_hct_grade: TcxGridDBColumn;
    cxGrid1DBTableView1pre_labor_service1_date: TcxGridDBColumn;
    cxGrid1DBTableView1pre_labor_service2_date: TcxGridDBColumn;
    cxGrid1DBTableView1pre_labor_service3_date: TcxGridDBColumn;
    cxGrid1DBTableView1pre_labor_service4_date: TcxGridDBColumn;
    cxGrid1DBTableView1Column12: TcxGridDBColumn;
    cxGrid1DBTableView1first_doctor_date: TcxGridDBColumn;
    cxGrid1DBTableView1risk_list: TcxGridDBColumn;
    cxGrid1DBTableView1risk_refer_date: TcxGridDBColumn;
    cxGrid1DBTableView1psycho_eval_score: TcxGridDBColumn;
    cxGrid1DBTableView1anc_vc_result_id: TcxGridDBColumn;
    cxGrid1DBTableView1post_labor_service1_date: TcxGridDBColumn;
    cxGrid1DBTableView1post_labor_service2_date: TcxGridDBColumn;
    cxGrid1DBTableView1Column14: TcxGridDBColumn;
    cxGrid1DBTableView1preg_begin_date: TcxGridDBColumn;
    cxGrid1DBTableView1labor_place_id: TcxGridDBColumn;
    cxGrid1DBTableView1labor_doctor_type_id: TcxGridDBColumn;
    cxGrid1DBTableView1alive_child_count: TcxGridDBColumn;
    cxGrid1DBTableView1dead_child_count: TcxGridDBColumn;
    cxGrid1DBTableView1Column11: TcxGridDBColumn;
    cxGrid1DBTableView1Column21: TcxGridDBColumn;
    cxGrid1DBTableView1Column22: TcxGridDBColumn;
    cxGrid1DBTableView1Column26: TcxGridDBColumn;
    cxGrid1Level1: TcxGridLevel;
    
    procedure cxGrid1DBTableView1DBColumn1GetDisplayText(
      Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);

    procedure AddButtonClick(Sender: TObject);
    procedure EditButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
  private
    FPersonID: integer;
    { Private declarations }
    
    procedure RefreshData;
    procedure SetPersonID(const Value: integer);
  public
    { Public declarations }
   
    property PersonID : integer read FPersonID write SetPersonID;
  end;



implementation
uses HOSxPDMU,BMSApplicationUtil;


{$R *.dfm}

procedure THOSxPPCUAccount2ListFrame.AddButtonClick(Sender: TObject);
begin
   ExecuteRTTIFunction('HOSxPPCUAccount2EntryFormUnit.THOSxPPCUAccount2EntryForm','DoShowForm',[FPersonID,0]);
   RefreshData;
end;

procedure THOSxPPCUAccount2ListFrame.EditButtonClick(Sender: TObject);
begin
    if PersonANCListCDS.RecordCount=0 then
   exit;
   ExecuteRTTIFunction('HOSxPPCUAccount2EntryFormUnit.THOSxPPCUAccount2EntryForm','DoShowForm',[FPersonID,
   PersonANCListCDS.FieldByName('person_anc_id').AsInteger
   ]);
   RefreshData;
end;

procedure THOSxPPCUAccount2ListFrame.LogViewButtonClick(Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc"',
    '']);
end;



procedure THOSxPPCUAccount2ListFrame.cxGrid1DBTableView1DBColumn1GetDisplayText(
  Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  atext:=inttostr(arecord.Index+1);
end;


procedure THOSxPPCUAccount2ListFrame.RefreshData;
var V:Variant;
begin

   v := 0;

   if PersonANCListCDS.active then
   if PersonANCListCDS.recordcount>0 then
   V:=PersonANCListCDS.fieldbyname('person_anc_id').asVariant;

   PersonANCListCDS.Data := hosxp_getdataset
    ('select a.*,concat(p.pname,p.fname," ",p.lname) as ptname  ,p.current_age,p.age_y,p.age_m ,p.cid, '
    + ' h.address,h.road,v.village_moo,v.village_name,t.full_name as full_address_name,p.patient_hn '
    + ' , ats.labor_status_name ' + ' from person_anc a ' +
    ' left outer join person p on p.person_id = a.person_id ' +
    ' left outer join house h on h.house_id = p.house_id ' +
    ' left outer join village v on v.village_id = p.village_id ' +
    ' left outer join labor_status ats on ats.labor_status_id = a.labor_status_id '
    + ' left outer join thaiaddress t on t.addressid = v.address_id ' +
    ' where a.person_id = '+inttostr(fpersonid)
    + ' order by a.person_anc_no ');
  if v >0 then
  PersonANCListCDS.locate('person_anc_id',vararrayof([v]),[]);

end;

procedure THOSxPPCUAccount2ListFrame.SetPersonID(const Value: integer);
begin
  FPersonID := Value;
end;

end.
